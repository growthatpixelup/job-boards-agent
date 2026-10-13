import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";

// The PIXELUP Search Dashboard's face: DM Sans at every size.
const sans = DM_Sans({ variable: "--font-dm-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Pixelup leads",
  description: "Qualified Contra leads and their stages",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} h-full`}>
      <body className="flex min-h-full flex-col text-sm">{children}</body>
    </html>
  );
}
