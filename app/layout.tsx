import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Подбор подрядчиков под мероприятие · neIT.kz",
  description:
    "До трёх подрядчиков с объяснением, почему именно они, и честный разбор, кого отсеяли и по какой причине.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
