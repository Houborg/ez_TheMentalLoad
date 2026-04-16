import nodemailer from 'nodemailer';
import type { MailSettings } from '@mental-load/contracts';

export interface ReminderNotificationPayload {
  to: string;
  subject: string;
  text: string;
}

export interface MailActionResult {
  ok: boolean;
  preview: boolean;
  transport: 'log' | 'smtp';
  message: string;
}

export class MailService {
  async sendReminder(payload: ReminderNotificationPayload, settings?: Partial<MailSettings>): Promise<MailActionResult> {
    return this.sendMail(payload, settings);
  }

  async sendInvite(payload: ReminderNotificationPayload, settings?: Partial<MailSettings>): Promise<MailActionResult> {
    return this.sendMail(payload, settings);
  }

  async sendTestEmail(to: string, settings?: Partial<MailSettings>): Promise<MailActionResult> {
    return this.sendMail({
      to,
      subject: 'MentalLoad mail test',
      text: 'Your MentalLoad mail settings are working and ready for reminders and invite sync.',
    }, settings);
  }

  private async sendMail(payload: ReminderNotificationPayload, settings?: Partial<MailSettings>): Promise<MailActionResult> {
    const smtpHost = settings?.smtpHost || process.env.SMTP_HOST;
    const smtpPort = Number(settings?.smtpPort ?? process.env.SMTP_PORT ?? 1025);
    const smtpUser = settings?.smtpUser || process.env.SMTP_USER;
    const smtpPass = settings?.smtpPass || process.env.SMTP_PASS;
    const smtpFrom = settings?.smtpFrom || process.env.SMTP_FROM || 'mental-load@local.test';
    const previewMode = settings?.previewMode ?? !smtpHost;

    if (!smtpHost || previewMode) {
      console.log(`[mail-preview] ${payload.subject} -> ${payload.to}`);
      return {
        ok: true,
        preview: true,
        transport: 'log',
        message: `Previewed email for ${payload.to}.`,
      };
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: smtpUser ? { user: smtpUser, pass: smtpPass } : undefined,
    });

    await transporter.sendMail({
      from: smtpFrom,
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
    });

    return {
      ok: true,
      preview: false,
      transport: 'smtp',
      message: `Email sent to ${payload.to}.`,
    };
  }
}
