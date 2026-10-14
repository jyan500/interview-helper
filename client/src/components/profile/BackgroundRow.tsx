/**
 * One entry in a Profile background list — a role (ExperienceCard) or a project (ProjectsCard). Both read
 * the same way: a bold title, a muted subtitle line (company · dates, or the project's link), the
 * description, and Edit / Delete icon buttons on the right.
 *
 * `loading` renders a shape-matching skeleton instead (title bar, subtitle bar, two description lines)
 * so the list doesn't jump when the real rows arrive.
 */
import type { ReactNode } from "react";
import { PencilSimple, Trash } from "@phosphor-icons/react";
import Button from "../Button";
import { Skeleton } from "../Skeleton";

type BackgroundRowProps =
    | { loading: true }
    | {
          loading?: false;
          title: string;
          subtitle?: ReactNode;
          description?: string;
          onEdit: () => void;
          onDelete: () => void;
      };

export default function BackgroundRow(props: BackgroundRowProps) {
    if (props.loading) {
        return (
            <li className="py-4">
                <Skeleton className="h-[18px] w-1/3" />
                <Skeleton className="mt-2 h-[13px] w-1/4" />
                <Skeleton className="mt-3 h-[13px] w-full" />
                <Skeleton className="mt-1.5 h-[13px] w-2/3" />
            </li>
        );
    }

    const { title, subtitle, description, onEdit, onDelete } = props;
    return (
        <li className="flex items-start justify-between gap-4 py-4">
            <div className="min-w-0">
                <div className="text-[15.5px] font-medium text-ink">{title}</div>
                {subtitle && <div className="mt-0.5 text-[13px] text-neutral-400">{subtitle}</div>}
                {description && (
                    <p className="mt-2 line-clamp-3 whitespace-pre-line text-[13.5px] leading-[1.5] text-neutral-300">
                        {description}
                    </p>
                )}
            </div>
            <div className="flex shrink-0 gap-1">
                <Button variant="ghost" icon aria-label={`Edit ${title}`} title="Edit" onClick={onEdit}>
                    <PencilSimple size={17} weight="regular" />
                </Button>
                <Button variant="ghost" icon aria-label={`Delete ${title}`} title="Delete" onClick={onDelete}>
                    <Trash size={17} weight="regular" />
                </Button>
            </div>
        </li>
    );
}
