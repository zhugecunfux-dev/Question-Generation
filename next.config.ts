import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native addons and PDFKit's runtime AFM/font data must stay next to their
  // installed packages instead of being flattened into Next's server chunks.
  serverExternalPackages: ["better-sqlite3", "pdfkit", "svg-to-pdfkit"],
};

export default nextConfig;
