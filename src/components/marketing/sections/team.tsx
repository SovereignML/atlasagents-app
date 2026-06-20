"use client";

import { motion } from "framer-motion";
import { easing } from "@/lib/motion";
import { RevealGroup, RevealItem } from "@/components/marketing/motion/reveal";

/*
 * Team section. All member details are placeholders pending real data.
 * {{TODO: founder names, roles, one-line bios, and photos}}
 *
 * When photos are available, drop .avif files into
 * public/assets/team/<slug>.avif and swap the initials avatar for a
 * <next/image> (see the commented example in <Avatar/> below).
 */
type Member = {
  name: string;
  role: string;
  bio: string;
  /** public/assets/team/<photo>.avif — leave empty to show the initials avatar */
  photo?: string;
};

const TEAM: Member[] = [
  {
    name: "{{TODO: founder name}}",
    role: "{{TODO: role}}",
    bio: "{{TODO: one-line bio}}",
    photo: "", // {{TODO: /assets/team/<slug>.avif}}
  },
  {
    name: "{{TODO: founder name}}",
    role: "{{TODO: role}}",
    bio: "{{TODO: one-line bio}}",
    photo: "", // {{TODO: /assets/team/<slug>.avif}}
  },
];

function initials(name: string) {
  const cleaned = name.replace(/\{\{.*?\}\}/g, "").trim();
  if (!cleaned) return "—";
  return cleaned
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function Avatar({ member }: { member: Member }) {
  // When a real photo exists, render it instead of the initials placeholder:
  //   <Image src={member.photo} alt={member.name} width={96} height={96}
  //     className="w-24 h-24 rounded-full object-cover" />
  return (
    <div className="w-24 h-24 rounded-full flex items-center justify-center bg-accent-blue-rest/10 border border-border-muted text-accent-blue-rest text-2xl font-bold">
      {initials(member.name)}
    </div>
  );
}

export function Team() {
  return (
    <section id="team" className="relative py-32 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background-faint/30 to-transparent" />

      <div className="max-w-[1100px] mx-auto px-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 48, filter: "blur(4px)" }}
          whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: 0.8, ease: easing.outExpo }}
          className="text-center mb-16"
        >
          <p className="text-xs text-accent-blue-rest uppercase tracking-[0.2em] mb-4 font-medium">Team</p>
          <h2 className="text-[clamp(2rem,4vw,48px)] font-bold text-text-loud tracking-[-1.5px] mb-5">
            The people behind SovereignML.
          </h2>
          <p className="text-text-secondary text-lg max-w-[460px] mx-auto">
            A small team building the easiest way to run autonomous AI agents.
          </p>
        </motion.div>

        <RevealGroup className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-[760px] mx-auto">
          {TEAM.map((member, i) => (
            <RevealItem
              key={i}
              whileHover={{ y: -4 }}
              className="glass-subtle rounded-2xl p-8 flex flex-col items-center text-center"
            >
              <Avatar member={member} />
              <h3 className="mt-5 text-lg font-bold text-text-loud">{member.name}</h3>
              <p className="mt-1 text-sm text-accent-blue-rest">{member.role}</p>
              <p className="mt-3 text-sm text-text-secondary leading-relaxed">{member.bio}</p>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}
