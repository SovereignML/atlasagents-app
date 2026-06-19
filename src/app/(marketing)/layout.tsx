import { MotionConfig } from "framer-motion";
import { auth } from "@/auth";
import Navbar from "@/components/layout/navbar";
import Footer from "@/components/layout/footer";

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const isAuthenticated = Boolean(session?.user);

  return (
    // reducedMotion="user" makes every motion.* descendant honor the OS
    // "Reduce Motion" setting (transforms/layout dropped, opacity kept).
    <MotionConfig reducedMotion="user">
      <Navbar isAuthenticated={isAuthenticated} />
      <main className="relative z-10 min-h-screen pt-[100px]">{children}</main>
      <Footer />
    </MotionConfig>
  );
}
