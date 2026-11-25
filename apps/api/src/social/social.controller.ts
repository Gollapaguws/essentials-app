import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { Auth, CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";
import { prisma } from "@essentials/db";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { SocialPublishService, autoPublishPlatforms, COMPOSER_LINKS, MANUAL_PLATFORMS, type Platform } from "./social-publish.service";
import { SocialAgentService } from "./social-agent.service";
import { SocialSchedulerService } from "./social-scheduler.service";
import { BillingService } from "../billing/billing.service";
import { EntitlementsService } from "../billing/entitlements.service";
import { RequiresEntitlement } from "../billing/entitlement.decorator";
import { ConfigService } from "@nestjs/config";
import { IsArray, IsOptional, IsString, MaxLength } from "class-validator";

class GenerateDto {
  @IsString() @MaxLength(500) topic!: string;
  @IsArray() platforms!: string[];
  @IsOptional() @IsString() @MaxLength(40) tone?: string;
  @IsOptional() includeHashtags?: boolean;
  @IsOptional() @IsString() @MaxLength(40) eventDate?: string;
  @IsOptional() @IsString() @MaxLength(80) venue?: string;
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
    private billing: BillingService,
    private entitlements: EntitlementsService,
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
  @RequiresEntitlement("social.publishes")
  async create(
    @CurrentUser() user: JwtUser,
    @Body() dto: { content: string; platforms: string[]; mediaUrl?: string; scheduledAt?: string },
  ) {
    const post = await prisma.socialPost.create({
      data: {
        orgId: user.orgId ?? null,
        content: dto.content,
        platforms: dto.platforms,
        mediaUrl: dto.mediaUrl ?? null,
        createdBy: user.sub,
        status: dto.scheduledAt ? "scheduled" : "draft",
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
      },
    });
    const orgId = post.orgId ?? user.orgId;
    if (!dto.scheduledAt) {
      // The route is gated by @RequiresEntitlement, so a publish that goes out
      // now consumes one allowance and is marked as counted.
      const result = await this.scheduler.publishNow(post.id, dto.content, dto.platforms as Platform[], dto.mediaUrl);
      await this.meterPost(post.id, orgId);
      return { postId: post.id, ...result };
    }
    // A scheduled post is counted when it is created, not when the scheduler
    // later publishes it: there is no request then to refuse, so the allowance
    // has to be taken up front or the cap could be bypassed by scheduling.
    await this.meterPost(post.id, orgId);
    return { postId: post.id, status: "scheduled", scheduledAt: dto.scheduledAt };
  }

  /** Publish an existing draft immediately. */
  @Post("posts/:id/publish")
  @HttpCode(200)
  @Auth("promoter", "admin")
  async publishNow(@Param("id") id: string, @CurrentUser() user: JwtUser, @Body() dto: PublishDto) {
    const post = await prisma.socialPost.findUnique({ where: { id } });
    if (!post) return { ok: false };
    if (
      user.role !== "admin" &&
      post.createdBy !== user.sub &&
      !(post.orgId && post.orgId === user.orgId)
    ) {
      throw new ForbiddenException("Not your post");
    }
    const platforms = (dto.platforms ?? post.platforms) as Parameters<typeof this.scheduler.publishNow>[2];
    const orgId = post.orgId ?? user.orgId;
    // A scheduled post already paid for its publish at creation. Anything else
    // (a draft left by a failed publish, for instance) is gated and counted now.
    if (!post.meteredAt && orgId) {
      await this.entitlements.check(orgId, "social.publishes");
    }
    const result = await this.scheduler.publishNow(id, post.content, platforms as Platform[], post.mediaUrl ?? undefined);
    if (!post.meteredAt) await this.meterPost(id, orgId);
    return result;
  }

  /** Count one publish against the workspace and remember that it was counted. */
  private async meterPost(id: string, orgId: string | null | undefined) {
    if (!orgId) return;
    await this.billing.record(orgId, "social.publishes");
    await prisma.socialPost.update({ where: { id }, data: { meteredAt: new Date() } });
  }

  @Get("posts")
  @Auth("promoter", "admin")
  async posts(@CurrentUser() user: JwtUser) {
    return prisma.socialPost.findMany({
      // Admins keep platform-wide visibility. A promoter sees their workspace's
      // calendar, plus anything they themselves created before workspaces existed.
      where:
        user.role === "admin"
          ? undefined
          : user.orgId
            ? { OR: [{ orgId: user.orgId }, { createdBy: user.sub }] }
            : { createdBy: user.sub },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  @Delete("posts/:id")
  @Auth("admin")
  async deletePost(@Param("id") id: string) {
    await prisma.socialPost.delete({ where: { id } }).catch(() => null);
    return { ok: true };
  }
}
