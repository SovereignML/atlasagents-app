"use client"

import React, { useState } from "react"
import {
  CheckCircle2,
  Circle,
  CircleAlert,
  CircleDotDashed,
  CircleX,
} from "lucide-react"
import { motion, AnimatePresence, LayoutGroup, type Variants } from "framer-motion"

// Status values shared with the deployment-stage mapper.
export type StageStatus =
  | "completed"
  | "in-progress"
  | "pending"
  | "need-help"
  | "failed"

export interface Subtask {
  id: string
  title: string
  description: string
  status: StageStatus
  priority?: string
  tools?: string[]
}

export interface Task {
  id: string
  title: string
  description: string
  status: StageStatus
  priority?: string
  level?: number
  dependencies?: string[]
  subtasks: Subtask[]
}

function StatusIcon({ status, size }: { status: StageStatus; size: "sm" | "md" }) {
  const cls = size === "md" ? "h-4.5 w-4.5" : "h-3.5 w-3.5"
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={status}
        initial={{ opacity: 0, scale: 0.8, rotate: -10 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        exit={{ opacity: 0, scale: 0.8, rotate: 10 }}
        transition={{ duration: 0.2, ease: [0.2, 0.65, 0.3, 0.9] }}
      >
        {status === "completed" ? (
          <CheckCircle2 className={`${cls} text-green-500`} />
        ) : status === "in-progress" ? (
          <CircleDotDashed className={`${cls} text-blue-500`} />
        ) : status === "need-help" ? (
          <CircleAlert className={`${cls} text-yellow-500`} />
        ) : status === "failed" ? (
          <CircleX className={`${cls} text-red-500`} />
        ) : (
          <Circle className={`text-muted-foreground ${cls}`} />
        )}
      </motion.div>
    </AnimatePresence>
  )
}

function statusBadgeClass(status: StageStatus): string {
  switch (status) {
    case "completed":
      return "bg-green-100 text-green-700"
    case "in-progress":
      return "bg-blue-100 text-blue-700"
    case "need-help":
      return "bg-yellow-100 text-yellow-700"
    case "failed":
      return "bg-red-100 text-red-700"
    default:
      return "bg-muted text-muted-foreground"
  }
}

/**
 * Controlled, data-driven plan/checklist. Renders the supplied `tasks` and
 * their `subtasks`; status is driven entirely by props (no internal mutation).
 * Adapted from the shared agent-plan component — expansion is local UI state.
 */
export default function Plan({
  tasks,
  defaultExpandedTaskIds,
}: {
  tasks: Task[]
  defaultExpandedTaskIds?: string[]
}) {
  const [expandedTasks, setExpandedTasks] = useState<string[]>(
    defaultExpandedTaskIds ?? tasks.map((t) => t.id),
  )
  const [expandedSubtasks, setExpandedSubtasks] = useState<{
    [key: string]: boolean
  }>({})

  const prefersReducedMotion =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false

  const toggleTaskExpansion = (taskId: string) => {
    setExpandedTasks((prev) =>
      prev.includes(taskId)
        ? prev.filter((id) => id !== taskId)
        : [...prev, taskId],
    )
  }

  const toggleSubtaskExpansion = (taskId: string, subtaskId: string) => {
    const key = `${taskId}-${subtaskId}`
    setExpandedSubtasks((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const taskVariants: Variants = {
    hidden: { opacity: 0, y: prefersReducedMotion ? 0 : -5 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        type: prefersReducedMotion ? "tween" : "spring",
        stiffness: 500,
        damping: 30,
        duration: prefersReducedMotion ? 0.2 : undefined,
      },
    },
    exit: { opacity: 0, y: prefersReducedMotion ? 0 : -5, transition: { duration: 0.15 } },
  }

  const subtaskListVariants: Variants = {
    hidden: { opacity: 0, height: 0, overflow: "hidden" },
    visible: {
      height: "auto",
      opacity: 1,
      overflow: "visible",
      transition: {
        duration: 0.25,
        staggerChildren: prefersReducedMotion ? 0 : 0.05,
        when: "beforeChildren",
        ease: [0.2, 0.65, 0.3, 0.9],
      },
    },
    exit: { height: 0, opacity: 0, overflow: "hidden", transition: { duration: 0.2, ease: [0.2, 0.65, 0.3, 0.9] } },
  }

  const subtaskVariants: Variants = {
    hidden: { opacity: 0, x: prefersReducedMotion ? 0 : -10 },
    visible: {
      opacity: 1,
      x: 0,
      transition: {
        type: prefersReducedMotion ? "tween" : "spring",
        stiffness: 500,
        damping: 25,
        duration: prefersReducedMotion ? 0.2 : undefined,
      },
    },
    exit: { opacity: 0, x: prefersReducedMotion ? 0 : -10, transition: { duration: 0.15 } },
  }

  const subtaskDetailsVariants: Variants = {
    hidden: { opacity: 0, height: 0, overflow: "hidden" },
    visible: { opacity: 1, height: "auto", overflow: "visible", transition: { duration: 0.25, ease: [0.2, 0.65, 0.3, 0.9] } },
  }

  return (
    <div className="text-foreground overflow-auto">
      <LayoutGroup>
        <div className="overflow-hidden">
          <ul className="space-y-1 overflow-hidden">
            {tasks.map((task, index) => {
              const isExpanded = expandedTasks.includes(task.id)
              const isCompleted = task.status === "completed"
              const dependencies = task.dependencies ?? []

              return (
                <motion.li
                  key={task.id}
                  className={index !== 0 ? "mt-1 pt-2" : ""}
                  initial="hidden"
                  animate="visible"
                  variants={taskVariants}
                >
                  <motion.div className="group flex items-center px-3 py-1.5 rounded-md">
                    <div className="mr-2 flex-shrink-0">
                      <StatusIcon status={task.status} size="md" />
                    </div>

                    <motion.div
                      className="flex min-w-0 flex-grow cursor-pointer items-center justify-between"
                      onClick={() => toggleTaskExpansion(task.id)}
                    >
                      <div className="mr-2 flex-1 truncate">
                        <span className={isCompleted ? "text-muted-foreground" : ""}>
                          {task.title}
                        </span>
                      </div>

                      <div className="flex flex-shrink-0 items-center space-x-2 text-xs">
                        {dependencies.length > 0 && (
                          <div className="mr-2 flex flex-wrap gap-1">
                            {dependencies.map((dep, idx) => (
                              <span
                                key={idx}
                                className="bg-secondary/40 text-secondary-foreground rounded px-1.5 py-0.5 text-[10px] font-medium shadow-sm"
                              >
                                {dep}
                              </span>
                            ))}
                          </div>
                        )}
                        <span className={`rounded px-1.5 py-0.5 ${statusBadgeClass(task.status)}`}>
                          {task.status}
                        </span>
                      </div>
                    </motion.div>
                  </motion.div>

                  <AnimatePresence mode="wait">
                    {isExpanded && task.subtasks.length > 0 && (
                      <motion.div
                        className="relative overflow-hidden"
                        variants={subtaskListVariants}
                        initial="hidden"
                        animate="visible"
                        exit="hidden"
                        layout
                      >
                        <div className="absolute top-0 bottom-0 left-[20px] border-l-2 border-dashed border-muted-foreground/30" />
                        <ul className="border-muted mt-1 mr-2 mb-1.5 ml-3 space-y-0.5">
                          {task.subtasks.map((subtask) => {
                            const subtaskKey = `${task.id}-${subtask.id}`
                            const isSubtaskExpanded = expandedSubtasks[subtaskKey]

                            return (
                              <motion.li
                                key={subtask.id}
                                className="group flex flex-col py-0.5 pl-6"
                                onClick={() => toggleSubtaskExpansion(task.id, subtask.id)}
                                variants={subtaskVariants}
                                initial="hidden"
                                animate="visible"
                                exit="exit"
                                layout
                              >
                                <motion.div className="flex flex-1 items-center rounded-md p-1" layout>
                                  <div className="mr-2 flex-shrink-0">
                                    <StatusIcon status={subtask.status} size="sm" />
                                  </div>
                                  <span
                                    className={`cursor-pointer text-sm ${subtask.status === "completed" ? "text-muted-foreground" : ""}`}
                                  >
                                    {subtask.title}
                                  </span>
                                </motion.div>

                                <AnimatePresence mode="wait">
                                  {isSubtaskExpanded && (
                                    <motion.div
                                      className="text-muted-foreground border-foreground/20 mt-1 ml-1.5 border-l border-dashed pl-5 text-xs overflow-hidden"
                                      variants={subtaskDetailsVariants}
                                      initial="hidden"
                                      animate="visible"
                                      exit="hidden"
                                      layout
                                    >
                                      <p className="py-1">{subtask.description}</p>
                                      {subtask.tools && subtask.tools.length > 0 && (
                                        <div className="mt-0.5 mb-1 flex flex-wrap items-center gap-1.5">
                                          <span className="text-muted-foreground font-medium">
                                            Details:
                                          </span>
                                          <div className="flex flex-wrap gap-1">
                                            {subtask.tools.map((tool, idx) => (
                                              <span
                                                key={idx}
                                                className="bg-secondary/40 text-secondary-foreground rounded px-1.5 py-0.5 text-[10px] font-medium shadow-sm"
                                              >
                                                {tool}
                                              </span>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </motion.li>
                            )
                          })}
                        </ul>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.li>
              )
            })}
          </ul>
        </div>
      </LayoutGroup>
    </div>
  )
}
