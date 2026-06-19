import {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarBadge,
} from "sovereign";

export function MemberAvatar() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <Avatar>
        <AvatarImage
          src="https://i.pravatar.cc/80?img=12"
          alt="Maya Okonkwo"
        />
        <AvatarFallback>MO</AvatarFallback>
      </Avatar>
      <Avatar size="lg">
        <AvatarFallback>JR</AvatarFallback>
      </Avatar>
      <Avatar size="sm">
        <AvatarFallback>SL</AvatarFallback>
      </Avatar>
    </div>
  );
}

export function OnlineMember() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <Avatar size="lg">
        <AvatarImage src="https://i.pravatar.cc/80?img=32" alt="Priya Anand" />
        <AvatarFallback>PA</AvatarFallback>
        <AvatarBadge style={{ background: "var(--primary)" }} />
      </Avatar>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Priya Anand</span>
        <span style={{ fontSize: 12, color: "var(--primary)" }}>
          Online · Owner
        </span>
      </div>
    </div>
  );
}

export function TeamGroup() {
  return (
    <AvatarGroup>
      <Avatar>
        <AvatarImage src="https://i.pravatar.cc/80?img=5" alt="Ana" />
        <AvatarFallback>AN</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarImage src="https://i.pravatar.cc/80?img=8" alt="Devon" />
        <AvatarFallback>DV</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback>KT</AvatarFallback>
      </Avatar>
      <AvatarGroupCount>+6</AvatarGroupCount>
    </AvatarGroup>
  );
}
