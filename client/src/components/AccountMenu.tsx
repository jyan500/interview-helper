/**
 * The nav's account menu: the avatar (picture-or-initials) opens a Dropdown with the two account pages,
 * Profile (picture, default role/level, background) and User settings (name, email, password). Both live
 * under /settings, whose sidebar also reaches Interview settings.
 */
import { Gear, User } from "@phosphor-icons/react";
import Dropdown from "./Dropdown";
import DropdownItem from "./DropdownItem";
import UserAvatar from "./UserAvatar";

const ACCOUNT_MENU_ITEMS = [
    { to: "/settings/profile", label: "Profile", icon: User },
    { to: "/settings/user", label: "User settings", icon: Gear },
];

export default function AccountMenu() {
    return (
        <Dropdown
            label="Account menu"
            trigger={(open) => (
                <UserAvatar
                    className={`h-[30px] w-[30px] transition-colors hover:border-accent ${
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
