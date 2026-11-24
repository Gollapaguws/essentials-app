import { Controller, Get, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { HealthService } from "./health.service";

/**
 * Public readiness probe. Answers 503 when a dependency is unreachable so an
 * uptime monitor and the load balancer see the same truth the API does.
 */
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  // Probes are chatty by design; give them room without opening the floodgates.
  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  async check(@Res({ passthrough: true }) res: Response) {
    const report = await this.health.check();
    if (!report.ok) res.status(503);
    return {
      service: "essentials-api",
      time: new Date().toISOString(),
      ...report,
    };
  }
}
