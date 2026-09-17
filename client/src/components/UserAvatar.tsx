/**
 * The current user's avatar, self-supplied from the Redux `user` slice — picture if they've uploaded
 * one, else their initials (see <Avatar>). This is the store-connected wrapper: call sites render
 * <UserAvatar/> with just the sizing/framing classes and never thread the identity down, which is the
 * whole reason the identity lives in a slice. (<Avatar> stays the dumb presentational primitive; this
 * is the one that knows WHO.)
 *
 * Sizing stays per call site (className height/width/border, textClassName for the initials font),
 * same convention as everywhere else — the component ships no dimensions of its own.
 */
import Avatar from "./Avatar";
import { useAppSelector } from "../store";

export default function UserAvatar({
    className = "",
    textClassName = "",
    alt,
}: {
    className?: string;
    textClassName?: string;
    alt?: string;
}) {
    const { initials, avatarUrl } = useAppSelector((s) => s.user);
    return <Avatar avatarUrl={avatarUrl} initials={initials} className={className} textClassName={textClassName} alt={alt} />;
}
