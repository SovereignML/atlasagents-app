import * as React from "react";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  Separator,
} from "sovereign";
import {
  MoreHorizontal,
  Play,
  RotateCcw,
  Square,
  Trash2,
} from "lucide-react";

export function QuickActions() {
  return (
    <Popover defaultOpen>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label="Actions" />}
      >
        <MoreHorizontal />
      </PopoverTrigger>
      <PopoverContent align="start">
        <PopoverHeader>
          <PopoverTitle>prod-inference-01</PopoverTitle>
          <PopoverDescription>Quick actions</PopoverDescription>
        </PopoverHeader>
        <Separator />
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <ActionItem icon={<Play />}>Start</ActionItem>
          <ActionItem icon={<Square />}>Stop</ActionItem>
          <ActionItem icon={<RotateCcw />}>Restart</ActionItem>
        </div>
        <Separator />
        <ActionItem icon={<Trash2 />} destructive>
          Destroy instance
        </ActionItem>
      </PopoverContent>
    </Popover>
  );
}

export function UsagePopover() {
  return (
    <Popover defaultOpen>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        Token usage
      </PopoverTrigger>
      <PopoverContent>
        <PopoverHeader>
          <PopoverTitle>This billing cycle</PopoverTitle>
          <PopoverDescription>Resets in 11 days</PopoverDescription>
        </PopoverHeader>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "var(--muted-foreground)" }}>Tokens</span>
          <span style={{ fontWeight: 500 }}>2.4M / 5M</span>
        </div>
        <div
          style={{
            height: 6,
            borderRadius: 999,
            background: "var(--muted)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: "48%",
              height: "100%",
              background: "var(--primary)",
            }}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "var(--muted-foreground)" }}>Spend</span>
          <span style={{ fontWeight: 500 }}>$168.00</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ActionItem({
  icon,
  children,
  destructive,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  destructive?: boolean;
}) {
  return (
    <button
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "6px 8px",
        borderRadius: 8,
        border: "none",
        background: "transparent",
        font: "inherit",
        fontSize: 13,
        textAlign: "left",
        cursor: "pointer",
        color: destructive ? "var(--destructive)" : "var(--foreground)",
      }}
    >
      <span style={{ display: "inline-flex", width: 16, height: 16 }}>
        {icon}
      </span>
      {children}
    </button>
  );
}
