/* eslint-disable @next/next/no-img-element */
import { BarChart3, ShieldCheck, FileText } from "lucide-react"

const FEATURES = [
  {
    icon: BarChart3,
    title: "Real-Time Analytics",
    description: "Get instant insights into your finances with live dashboards.",
    iconClass: "text-violet-600 dark:text-violet-400",
    bgClass: "bg-violet-100 dark:bg-violet-500/10",
  },
  {
    icon: ShieldCheck,
    title: "Bank-Grade Security",
    description: "End-to-end encryption, 2FA, compliance with GDPR standards.",
    iconClass: "text-green-600 dark:text-green-400",
    bgClass: "bg-green-100 dark:bg-green-500/10",
  },
  {
    icon: FileText,
    title: "Customizable Reports",
    description: "Export professional, audit-ready financial reports for tax or internal review.",
    iconClass: "text-orange-600 dark:text-orange-400",
    bgClass: "bg-orange-100 dark:bg-orange-500/10",
  },
]

export default function FeatureSections() {
  return (
    <section className="w-full py-16">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-10 px-4 md:flex-row md:px-6">
        {/* Sides reversed: feature list on the left, image on the right */}
        <div className="space-y-10 px-4 md:px-0">
          {FEATURES.map(({ icon: Icon, title, description, iconClass, bgClass }) => (
            <div key={title} className="flex max-w-md items-center justify-center gap-6">
              <div className={`aspect-square rounded-full p-6 ${bgClass}`}>
                <Icon className={`h-7 w-7 ${iconClass}`} strokeWidth={2} />
              </div>
              <div className="space-y-2">
                <h3 className="text-base font-semibold text-foreground">{title}</h3>
                <p className="text-sm text-muted-foreground">{description}</p>
              </div>
            </div>
          ))}
        </div>

        <img
          className="w-full max-w-2xl rounded-xl"
          src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=80"
          alt="Analytics dashboard"
        />
      </div>
    </section>
  )
}
