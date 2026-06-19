import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "sovereign";
import {
  MoreHorizontal,
  RefreshCw,
  Terminal,
  Archive,
  Globe,
  Trash2,
} from "lucide-react";

export function RowActions() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: 12 }}>
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label="Instance actions">
              <MoreHorizontal />
            </Button>
          }
        />
        <DropdownMenuContent align="start" style={{ width: 240 }}>
          <DropdownMenuLabel>prod-inference-01</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem>
              <RefreshCw />
              Restart instance
              <DropdownMenuShortcut>⌘R</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Terminal />
              Open console
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Globe />
              Manage domain
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Archive />
              Create backup
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive">
            <Trash2 />
            Destroy instance
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
