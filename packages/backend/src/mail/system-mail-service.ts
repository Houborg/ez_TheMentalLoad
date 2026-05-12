import nodemailer from 'nodemailer';

function getSystemSmtpConfig() {
  return {
    host: process.env.SYSTEM_SMTP_HOST ?? '',
    port: Number(process.env.SYSTEM_SMTP_PORT ?? 587),
    user: process.env.SYSTEM_SMTP_USER ?? '',
    pass: process.env.SYSTEM_SMTP_PASS ?? '',
    from: process.env.SYSTEM_SMTP_FROM ?? 'MentalLoad <noreply@example.com>',
  };
}

export class SystemMailService {
  private isConfigured(): boolean {
    return Boolean(process.env.SYSTEM_SMTP_HOST);
  }

  async sendVerificationEmail(to: string, verifyUrl: string): Promise<void> {
    const subject = 'Bekræft din e-mail — MentalLoad';
    const text = [
      'Hej!',
      '',
      'Klik på linket nedenfor for at bekræfte din e-mailadresse og aktivere din MentalLoad-konto:',
      '',
      verifyUrl,
      '',
      'Linket udløber om 24 timer.',
      '',
      'Hvis du ikke har oprettet en konto, kan du se bort fra denne e-mail.',
      '',
      '— MentalLoad',
    ].join('\n');

    await this.send(to, subject, text);
  }

  async sendWelcomeEmail(to: string, familyName: string, body: string): Promise<void> {
    const subject = `Velkommen til MentalLoad, familie ${familyName}! 🎉`;
    await this.send(to, subject, body);
  }

  private async send(to: string, subject: string, text: string): Promise<void> {
    if (!this.isConfigured()) {
      console.log(`[system-mail-preview] To: ${to} | Subject: ${subject}`);
      console.log(text);
      return;
    }

    const cfg = getSystemSmtpConfig();
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    });

    await transporter.sendMail({ from: cfg.from, to, subject, text });
  }
}
