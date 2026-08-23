"use client";

import { useRouter } from "next/navigation";
import { Button, type ButtonVariant } from "@/components/ui/button";

interface Action {
  label: string;
  to: string;
  variant: ButtonVariant;
}

const STATUS_ACTIONS: Record<string, Action[]> = {
  new: [
    { label: "Mark Drafted", to: "drafted", variant: "default" },
    { label: "Reject", to: "rejected", variant: "destructive" },
  ],
  drafted: [
    { label: "Mark Applied", to: "applied", variant: "default" },
    { label: "Reject", to: "rejected", variant: "destructive" },
  ],
  applied: [{ label: "Reopen", to: "new", variant: "outline" }],
  rejected: [{ label: "Reopen", to: "new", variant: "outline" }],
  auto_rejected: [{ label: "Restore", to: "new", variant: "outline" }],
};

export function ListingActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const actions = STATUS_ACTIONS[status] || [];

  async function move(to: string) {
    try {
      await fetch(`/api/listings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: to }),
      });
      router.refresh();
    } catch (err) {
      console.error("Failed to update status:", err);
    }
  }

  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((a) => (
        <Button
          key={a.to}
          size="sm"
          variant={a.variant}
          onClick={() => move(a.to)}
        >
          {a.label}
        </Button>
      ))}
    </div>
  );
}
