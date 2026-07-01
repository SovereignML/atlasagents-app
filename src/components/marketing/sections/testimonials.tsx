"use client";

import { motion } from "framer-motion";
import { TestimonialsColumn, type Testimonial } from "@/components/ui/testimonials-columns-1";

// NOTE: This section is currently NOT rendered (see src/app/page.tsx). The
// entries below are illustrative placeholders; replace with real, permissioned
// customer quotes before re-enabling the section.
const testimonials: Testimonial[] = [
  {
    text: "We launched a support agent in an afternoon. It now handles most of our tickets overnight, and escalations arrive with full context.",
    image: "https://randomuser.me/api/portraits/women/1.jpg",
    name: "Briana Patton",
    role: "Operations Manager",
  },
  {
    text: "Having our own private instance was the deciding factor. Customer data never leaves our deployment, which made security review painless.",
    image: "https://randomuser.me/api/portraits/men/2.jpg",
    name: "Bilal Ahmed",
    role: "IT Manager",
  },
  {
    text: "The onboarding team guided us through setup and kept iterating with us until the agent matched our tone and policies.",
    image: "https://randomuser.me/api/portraits/women/3.jpg",
    name: "Saman Malik",
    role: "Customer Support Lead",
  },
  {
    text: "Not being locked to one AI provider matters. When a better model ships, we switch with a config change. No rebuild.",
    image: "https://randomuser.me/api/portraits/men/4.jpg",
    name: "Omar Raza",
    role: "CEO",
  },
  {
    text: "Our DevOps agent watches logs and resolves the routine failures before anyone gets paged. On-call has gone quiet.",
    image: "https://randomuser.me/api/portraits/women/5.jpg",
    name: "Zainab Hussain",
    role: "Project Manager",
  },
  {
    text: "No code required turned out to be true. The team configured everything from the dashboard without touching an SDK.",
    image: "https://randomuser.me/api/portraits/women/6.jpg",
    name: "Aliza Khan",
    role: "Business Analyst",
  },
  {
    text: "We white-label agents for every client: isolated data, their branding, our margins. It changed our service model.",
    image: "https://randomuser.me/api/portraits/men/7.jpg",
    name: "Farhan Siddiqui",
    role: "Agency Director",
  },
  {
    text: "The sales agent qualifies leads around the clock and books straight into our calendar. Pipeline grew without new headcount.",
    image: "https://randomuser.me/api/portraits/women/8.jpg",
    name: "Sana Sheikh",
    role: "Sales Manager",
  },
  {
    text: "Deflection went up and CSAT followed. Customers get instant answers, and my team finally works on the hard problems.",
    image: "https://randomuser.me/api/portraits/men/9.jpg",
    name: "Hassan Ali",
    role: "E-commerce Manager",
  },
];

const firstColumn = testimonials.slice(0, 3);
const secondColumn = testimonials.slice(3, 6);
const thirdColumn = testimonials.slice(6, 9);

export function Testimonials() {
  return (
    <section className="bg-background my-20 relative">
      <div className="container z-10 mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          viewport={{ once: true }}
          className="flex flex-col items-center justify-center max-w-[540px] mx-auto"
        >
          <div className="flex justify-center">
            <div className="border py-1 px-4 rounded-lg">Testimonials</div>
          </div>

          <h2 className="text-center text-xl sm:text-2xl md:text-3xl lg:text-4xl xl:text-5xl font-bold tracking-tighter mt-5">
            How teams put their agents to work.
          </h2>
          <p className="text-center mt-5 opacity-75">
            Support, sales, devops, and agency teams, running on autopilot.
          </p>
        </motion.div>

        <div className="flex justify-center gap-6 mt-10 [mask-image:linear-gradient(to_bottom,transparent,black_25%,black_75%,transparent)] max-h-[740px] overflow-hidden">
          <TestimonialsColumn testimonials={firstColumn} duration={15} />
          <TestimonialsColumn testimonials={secondColumn} className="hidden md:block" duration={19} />
          <TestimonialsColumn testimonials={thirdColumn} className="hidden lg:block" duration={17} />
        </div>
      </div>
    </section>
  );
}
