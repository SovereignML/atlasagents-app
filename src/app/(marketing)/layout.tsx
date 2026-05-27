import { MotionConfig } from "framer-motion";
import Navbar from "@/components/layout/navbar";
import Footer from "@/components/layout/footer";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // reducedMotion="user" makes every motion.* descendant honor the OS
    // "Reduce Motion" setting (transforms/layout dropped, opacity kept).
    <MotionConfig reducedMotion="user">
      <Navbar />
      <main className="relative z-10 min-h-screen pt-[100px]">{children}</main>
      <Footer />
    </MotionConfig>
  );
}
