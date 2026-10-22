import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // IMAP/SMTP libraries use Node APIs that should not be bundled.
  serverExternalPackages: ["imapflow", "nodemailer", "mailparser"],
};

export default nextConfig;
