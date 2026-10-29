import { createParamDecorator, ExecutionContext, UseGuards, applyDecorators, SetMetadata } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { RolesGuard } from "./roles.guard";
import { Roles } from "./roles.decorator";
import type { Role } from "@prisma/client";

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().user;
});

/** Authenticate + optional role restriction, e.g. @Auth("promoter","admin") */
export function Auth(...roles: Role[]) {
  return applyDecorators(
    UseGuards(AuthGuard("jwt"), RolesGuard),
    ...(roles.length ? [Roles(...roles)] : []),
  );
}
