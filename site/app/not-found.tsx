import Link from "next/link";
import { Shell } from "@/components/Shell";

export default function NotFound() {
  return (
    <Shell>
      <section className="wrap nf" aria-label="Not found">
        <div className="label">404</div>
        <h1 className="serif">Nothing has emerged here.</h1>
        <p className="dim">The page you asked for does not exist. The ones that do:</p>
        <div className="cta">
          <Link className="btn primary" href="/">
            Home
          </Link>
          <Link className="btn" href="/how/">
            How it works
          </Link>
          <Link className="btn" href="/work/">
            Work
          </Link>
          <Link className="btn" href="/inside/">
            Under the hood
          </Link>
        </div>
      </section>
    </Shell>
  );
}
