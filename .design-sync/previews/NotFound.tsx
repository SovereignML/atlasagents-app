import { NotFound } from "sovereign";

// Full-bleed ghost 404 page. cardMode:single with a large viewport gives the
// hero room. Two exports show the logged-out and logged-in primary CTA labels.
export function Visitor() {
  return <NotFound isLoggedIn={false} />;
}

export function SignedIn() {
  return <NotFound isLoggedIn={true} />;
}
