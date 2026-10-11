import Link from "next/link";
export default function NotFound() {
  return <main className="section"><h1 className="text-2xl font-black">Page not found</h1><Link className="btn-primary mt-4" href="/">Return to the bakery</Link></main>;
}
