"use client"

import { useEffect, useState } from "react"
import { differenceInSeconds } from "date-fns"

export function CountdownTimer({ endDate }: { endDate: string }) {
  const [timeLeft, setTimeLeft] = useState("")

  useEffect(() => {
    function update() {
      const end = new Date(endDate)
      const now = new Date()
      const totalSeconds = differenceInSeconds(end, now)

      if (totalSeconds <= 0) {
        setTimeLeft("Expired")
        return
      }

      const days = Math.floor(totalSeconds / 86400)
      const hours = Math.floor((totalSeconds % 86400) / 3600)
      const minutes = Math.floor((totalSeconds % 3600) / 60)

      if (days > 0) {
        setTimeLeft(`${days}d ${hours}h ${minutes}m`)
      } else {
        setTimeLeft(`${hours}h ${minutes}m`)
      }
    }

    update()
    const interval = setInterval(update, 60000)
    return () => clearInterval(interval)
  }, [endDate])

  return (
    <span className={timeLeft === "Expired" ? "text-red-400" : "text-emerald-400 font-mono"}>
      {timeLeft}
    </span>
  )
}
