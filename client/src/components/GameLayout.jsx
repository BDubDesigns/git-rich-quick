import { Header } from "./Header";
import { Footer } from "./Footer";

export function GameLayout({ children }) {
  return (
    <div className="h-dvh flex flex-col relative sm:max-w-2xl sm:mx-auto lg:max-w-none">
      {" "}
      <header className="shrink-0 title-bar">
        <Header />
      </header>
      <main className="flex-1 overflow-y-auto px-1 mx-2 pb-2">{children}</main>
      <footer className="shrink-0 mb-2 mx-2">
        <Footer />
      </footer>
    </div>
  );
}
