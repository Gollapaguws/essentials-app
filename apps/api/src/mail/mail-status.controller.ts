import { Controller, Get } from "@nestjs/common";
import { MailHealthService, type MailStatus } from "./mail-health.service";

@Controller("mail")
export class MailStatusController {
  constructor(private readonly mail: MailHealthService) {}

  /**
   * Public on purpose: the sign-in screen has no session yet, and staff should
   * learn the relay is down before they tap Forgot password, not after.
   */
  @Get("status")
  status(): Promise<MailStatus> {
    return this.mail.status();
  }
}
