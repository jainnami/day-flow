import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Right Now | Make time for what matters", description: "Find a realistic time for your next task in Google Calendar." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
