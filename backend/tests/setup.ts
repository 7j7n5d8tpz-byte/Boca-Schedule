import 'dotenv/config';

// Suppress email sending during tests
process.env.RESEND_API_KEY = '';
process.env.SMTP_HOST = '';
