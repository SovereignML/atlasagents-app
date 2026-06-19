import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "sovereign";
import { RotateCw } from "lucide-react";

export function IconButtonHint() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
      <TooltipProvider>
        <Tooltip defaultOpen delay={0}>
          <TooltipTrigger
            render={
              <Button variant="outline" size="icon-sm" aria-label="Redeploy instance">
                <RotateCw />
              </Button>
            }
          />
          <TooltipContent side="top">Redeploy prod-inference-01</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
