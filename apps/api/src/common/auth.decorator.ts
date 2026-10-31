import { createParamDecorator, ExecutionContext, UseGuards, applyDecorators, SetMetadata } from "@nestjs/common";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { RolesGuard } from "./roles.guard";
import { Roles } from "./roles.decorator";
import type { Role } from "@prisma/client";

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().user;
});

/** Authenticate + optional role restriction, e.g. @Auth("promoter","admin") */
export function Auth(...roles: Role[]) {
  return applyDecorators(
    UseGuards(SupabaseAuthGuard, RolesGuard),
    ...(roles.length ? [Roles(...roles)] : []),
  );
}
