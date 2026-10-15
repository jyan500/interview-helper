/**
 * QuestionForm's shape while an edit's detail loads: question box, the type/level pair, roles, notes box.
 */
import { Skeleton } from "../Skeleton";

export default function QuestionFormSkeleton() {
    return (
        <div className="flex flex-col gap-4">
            <Skeleton className="h-[110px] w-full" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
            </div>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-[110px] w-full" />
        </div>
    );
}
