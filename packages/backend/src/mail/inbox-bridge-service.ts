import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import type { AppSettings } from '@mental-load/contracts';

export interface PullInboxToMailpitResult {
  ok: boolean;
  importedCount: number;
  latestUid: number;
  message: string;
}

export class InboxBridgeService {
  async pullInboxToMailpit(settings: AppSettings, sinceUid = 0, limit = 20): Promise<PullInboxToMailpitResult> {
    if (!settings.mail.imapHost || !settings.mail.imapUser || !settings.mail.imapPass) {
      return {
        ok: false,
        importedCount: 0,
        latestUid: sinceUid,
        message: 'IMAP settings are incomplete. Add host, user, and password first.',
      };
    }

    const client = new ImapFlow({
      host: settings.mail.imapHost,
      port: settings.mail.imapPort,
      secure: settings.mail.imapSecure,
      auth: {
        user: settings.mail.imapUser,
        pass: settings.mail.imapPass,
      },
    });

    const mailpitTransport = nodemailer.createTransport({
      host: process.env.MAILPIT_SMTP_HOST ?? 'mailpit',
      port: Number(process.env.MAILPIT_SMTP_PORT ?? 1025),
      secure: false,
    });

    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        const fetched: Array<{ uid: number; source?: Buffer }> = [];
        for await (const message of client.fetch('1:*', { uid: true, source: true })) {
          if (message.uid > sinceUid && message.source) {
            fetched.push({ uid: message.uid, source: message.source });
          }
        }

        fetched.sort((left, right) => left.uid - right.uid);
        const selected = fetched.slice(Math.max(fetched.length - limit, 0));
        let importedCount = 0;
        let latestUid = sinceUid;

        for (const message of selected) {
          if (!message.source) {
            continue;
          }

          const parsed = await simpleParser(message.source);
          const targetTo = addressToText(parsed.to) || settings.mail.testRecipient || settings.mail.imapUser;
          const subject = parsed.subject ? `[Inbox] ${parsed.subject}` : '[Inbox] No subject';
          const textBody = parsed.text?.trim() || '(No text body)';
          const from = addressToText(parsed.from) || settings.mail.imapUser;
          const htmlBody = parsed.html ? `<div>${parsed.html}</div>` : `<pre>${escapeHtml(textBody)}</pre>`;

          await mailpitTransport.sendMail({
            from,
            to: targetTo,
            subject,
            text: `From: ${from}\nTo: ${targetTo}\n\n${textBody}`,
            html: `<p><strong>From:</strong> ${escapeHtml(from)}</p><p><strong>To:</strong> ${escapeHtml(targetTo)}</p>${htmlBody}`,
          });

          importedCount += 1;
          latestUid = Math.max(latestUid, message.uid);
        }

        return {
          ok: true,
          importedCount,
          latestUid,
          message: importedCount > 0 ? `Forwarded ${importedCount} inbox email(s) into Mailpit.` : 'No new inbox emails found to forward.',
        };
      } finally {
        lock.release();
      }
    } catch (error) {
      return {
        ok: false,
        importedCount: 0,
        latestUid: sinceUid,
        message: error instanceof Error ? error.message : 'Inbox pull failed',
      };
    } finally {
      await client.logout().catch(() => undefined);
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function addressToText(value: unknown): string {
  if (!value) {
    return '';
  }

  if (typeof value === 'object' && value !== null && 'text' in value) {
    const text = (value as { text?: unknown }).text;
    return typeof text === 'string' ? text : '';
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => (typeof item === 'object' && item !== null && 'text' in item ? (item as { text?: unknown }).text : undefined))
      .filter((item): item is string => typeof item === 'string' && item.length > 0);
    return parts.join(', ');
  }

  return '';
}
