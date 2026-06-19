import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
} from "sovereign";
import { TriangleAlert } from "lucide-react";

export function ConfirmDestroy() {
  return (
    <AlertDialog defaultOpen>
      <AlertDialogTrigger render={<Button variant="destructive" />}>
        Destroy instance
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <TriangleAlert style={{ color: "var(--destructive)" }} />
          </AlertDialogMedia>
          <AlertDialogTitle>Destroy prod-inference-01?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the DigitalOcean droplet in nyc3, its
            attached volume, and all deploy history. Backups are retained for
            7 days. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep instance</AlertDialogCancel>
          <AlertDialogAction variant="destructive">
            Destroy permanently
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function RevokeAccess() {
  return (
    <AlertDialog defaultOpen>
      <AlertDialogTrigger render={<Button variant="outline" />}>
        Revoke key
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke API key?</AlertDialogTitle>
          <AlertDialogDescription>
            Key sk-live-…f29a will stop authenticating immediately. Any agent
            using it will lose access to the inference gateway.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive">Revoke</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
