/**
 * The nav's account menu: the avatar (picture-or-initials) opens a Dropdown with the three account pages
 * under /settings: Profile (picture, default role/level, background), User settings (name, email,
 * password) and Interview settings (mode, mic, voice).
 */
import { Gear, Microphone, User } from "@phosphor-icons/react";
import Dropdown from "./Dropdown";
import DropdownItem from "./DropdownItem";
import UserAvatar from "./UserAvatar";

const ACCOUNT_MENU_ITEMS = [
    { to: "/settings/profile", label: "Profile", icon: User },
    { to: "/settings/user", label: "User settings", icon: Gear },
    { to: "/settings/interview", label: "Interview settings", icon: Microphone },
];

export default function AccountMenu() {
    return (
        <Dropdown
            label="Account menu"
            trigger={(open) => (
                <UserAvatar
                    className={`h-[30px] w-[30px] cursor-pointer transition-colors hover:border-accent ${
                        open ? "border-accent" : "border-neutral-700"
                    }`}
                    textClassName="text-[11px] text-neutral-300"
                />
            )}
        >
            {ACCOUNT_MENU_ITEMS.map((item) => (
                <DropdownItem key={item.to} {...item} />
            ))}
        </Dropdown>
    );
}
