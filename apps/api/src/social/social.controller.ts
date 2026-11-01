import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { Auth, CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";
import { prisma } from "@essentials/db";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { SocialPublishService, autoPublishPlatforms, COMPOSER_LINKS, MANUAL_PLATFORMS, type Platform } from "./social-publish.service";
import { SocialAgentService } from "./social-agent.service";
import { SocialSchedulerService } from "./social-scheduler.service";
import { ConfigService } from "@nestjs/config";
import { IsArray, IsIn, IsOptional, IsString, MaxLength } from "class-validator";

class GenerateDto {
  @IsString() @MaxLength(500) topic!: string;
  @IsArray() platforms!: string[];
  @IsOptional() @IsString() @MaxLength(40) tone?: string;
  @IsOptional() includeHashtags?: boolean;
  @IsOptional() @IsString() @MaxLength(40) eventDate?: string;
  @IsOptional() @IsString() @MaxLength(80) venue?: string;
}

class CreatePostDto {
  @IsString() @MaxLength(2000) content!: string;
  @IsArray() platforms!: string[];
  @IsOptional() @IsString() @MaxLength(500) mediaUrl?: string;
  @IsOptional() @IsString() scheduledAt?: string;
}

class PublishDto {
  @IsOptional() @IsArray() platforms?: string[];
}

@Controller("social")
@UseGuards(SupabaseAuthGuard)
export class SocialController {
  private agent: SocialAgentService;

  constructor(
    private config: ConfigService,
    private publish: SocialPublishService,
    private scheduler: SocialSchedulerService,
  ) {
    this.agent = new SocialAgentService(config);
  }

  /** Which platforms auto-publish (credentials configured) vs manual copy-paste. */
  @Get("accounts")
  @Auth("promoter", "admin")
  accounts() {
    const auto = autoPublishPlatforms(this.config);
    return {
      autoPublish: auto,
      manual: MANUAL_PLATFORMS,
      composerLinks: COMPOSER_LINKS,
    };
  }

  /** Generate platform-tailored copy with the local agent (Ollama). */
  @Post("generate")
  @HttpCode(200)
  @Auth("promoter", "admin")
  generate(@CurrentUser() user: JwtUser, @Body() dto: GenerateDto) {
    return this.agent.generate(user, dto);
  }

  /** Create a post (publish now or schedule). */
  @Post("posts")
  @HttpCode(200)
  @Auth("promoter", "admin")
  async create(
    @CurrentUser() user: JwtUser,
    @Body() dto: { content: string; platforms: string[]; mediaUrl?: string; scheduledAt?: string },
  ) {
    const post = await prisma.socialPost.create({
      data: {
        content: dto.content,
        platforms: dto.platforms,
        mediaUrl: dto.mediaUrl ?? null,
        createdBy: user.sub,
        status: dto.scheduledAt ? "scheduled" : "draft",
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
      },
    });
    if (!dto.scheduledAt) {
      const result = await this.scheduler.publishNow(post.id, dto.content, dto.platforms as Platform[], dto.mediaUrl);
      return { postId: post.id, ...result };
    }
    return { postId: post.id, status: "scheduled", scheduledAt: dto.scheduledAt };
  }

  /** Publish an existing draft immediately. */
  @Post("posts/:id/publish")
  @HttpCode(200)
  @Auth("promoter", "admin")
  async publishNow(@Param("id") id: string, @CurrentUser() user: JwtUser, @Body() dto: PublishDto) {
    const post = await prisma.socialPost.findUnique({ where: { id } });
    if (!post) return { ok: false };
    const platforms = (dto.platforms ?? post.platforms) as Parameters<typeof this.scheduler.publishNow>[2];
    return this.scheduler.publishNow(id, post.content, platforms as Platform[], post.mediaUrl ?? undefined);
  }

  @Get("posts")
  @Auth("promoter", "admin")
  async posts() {
    return prisma.socialPost.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  }

  @Delete("posts/:id")
  @Auth("admin")
  async deletePost(@Param("id") id: string) {
    await prisma.socialPost.delete({ where: { id } }).catch(() => null);
    return { ok: true };
  }
}
