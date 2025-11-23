import { Header } from "./Header";
import { Footer } from "./Footer";

export function GameLayout({ children }) {
  return (
    <div className="h-screen flex flex-col relative md:max-w-md md:mx-auto">
      <header
        className="
            absolute top-0 left-0 right-0 z-10
            bg-slate-800 text-gray-400
      "
      >
        <Header />
      </header>

      <main className="flex-1 overflow-y-auto pt-20 pb-40">{children}</main>

      <footer
        className="
        absolute bottom-0 left-0 right-0 z-20
        bg-slate-800 text-gray-400"
      >
        <Footer />
      </footer>
    </div>
  );
}
