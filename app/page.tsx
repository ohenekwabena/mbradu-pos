import { redirect } from "next/navigation";

// The proxy sends unauthenticated visitors to /login; an authenticated visitor
// landing on the root is forwarded to the app home.
export default function Home() {
  redirect("/dashboard");
}
