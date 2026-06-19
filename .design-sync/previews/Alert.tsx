import { Alert, AlertAction, AlertDescription, AlertTitle, Button } from "sovereign";
import { CircleCheck, CircleX, Info, TriangleAlert } from "lucide-react";

export function Variants() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 540 }}>
      <Alert>
        <Info />
        <AlertTitle>Scheduled maintenance</AlertTitle>
        <AlertDescription>
          Backups run nightly at 02:00 UTC. Instances stay online throughout.
        </AlertDescription>
      </Alert>
      <Alert variant="success">
        <CircleCheck />
        <AlertTitle>Deployment complete</AlertTitle>
        <AlertDescription>
          prod-inference-01 is live and passing every health check.
        </AlertDescription>
      </Alert>
      <Alert variant="warning">
        <TriangleAlert />
        <AlertTitle>Approaching quota</AlertTitle>
        <AlertDescription>
          You've used 82% of your monthly token allowance.
        </AlertDescription>
      </Alert>
      <Alert variant="destructive">
        <CircleX />
        <AlertTitle>Provider unreachable</AlertTitle>
        <AlertDescription>
          Could not connect to the DigitalOcean API. Retrying in 30s.
        </AlertDescription>
      </Alert>
    </div>
  );
}

export function WithAction() {
  return (
    <div style={{ maxWidth: 540 }}>
      <Alert>
        <Info />
        <AlertTitle>New version available</AlertTitle>
        <AlertDescription>
          v2.4.0 adds the agent browser tools and faster cold starts.
        </AlertDescription>
        <AlertAction>
          <Button size="xs" variant="outline">
            Update
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
}
