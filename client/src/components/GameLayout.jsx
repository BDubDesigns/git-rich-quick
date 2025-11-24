import { Header } from "./Header";
import { Footer } from "./Footer";

export function GameLayout({ children }) {
  return (
    <div className="h-dvh flex flex-col relative md:max-w-md md:mx-auto">
      <header className="shrink-0 title-bar">
        <Header />
      </header>

      <main className="flex-1 overflow-y-auto">{children}</main>

      <footer className="shrink-0 mt-4 mb-2">
        <Footer />
      </footer>
    </div>
  );
}
