/**
 * Jobs — the candidate's saved job descriptions, each one a source of tailored interview rounds.
 * "New job" opens NewJobModal (paste a posting → the extractor saves it → its page opens).
 *
 * THE URL IS THE SOURCE OF TRUTH, same as the Interviews page: `q` (matched against company or title
 * server-side) and `page` are read from the query string every render, and the search form only WRITES
 * the URL on submit — never auto-applied on change.
 */
import { useState } from "react";
import { useSearchParams } from "react-router";
import { useForm } from "react-hook-form";
import { useGetJobsQuery } from "../api";
import { PAGE_SIZE } from "../constants";
import AppNav from "../components/AppNav";
import JobsTable from "../components/JobsTable";
import NewJobModal from "../components/NewJobModal";
import Pagination from "../components/Pagination";
import Button from "../components/Button";

type SearchForm = {
    q: string;
};

export default function JobsPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const q = searchParams.get("q") || undefined;
    const page = Number(searchParams.get("page")) || 1;

    const { data, isFetching, error } = useGetJobsQuery({ q, page, size: PAGE_SIZE });
    const [newOpen, setNewOpen] = useState(false);

    const { register, handleSubmit, reset } = useForm<SearchForm>({ defaultValues: { q: q ?? "" } });

    function applySearch({ q }: SearchForm) {
        const next = new URLSearchParams();
        if (q.trim()) next.set("q", q.trim());
        setSearchParams(next); // no `page` => page 1 of the new result set
    }

    function clearSearch() {
        reset({ q: "" });
        setSearchParams(new URLSearchParams());
    }

    function goToPage(p: number) {
        const next = new URLSearchParams(searchParams);
        next.set("page", String(p));
        setSearchParams(next);
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    return (
        <div className="min-h-screen bg-bg text-ink">
            {newOpen && <NewJobModal onClose={() => setNewOpen(false)} />}

            <AppNav />

            <div className="mx-auto max-w-[1280px]">
                <div className="px-7 pb-3 pt-[26px]">
                    <div className="flex items-end justify-between gap-5">
                        <div>
                            <h1 className="font-heading text-[30px] font-medium leading-[1.1] tracking-[-0.02em]">
                                Jobs
                            </h1>
                            <p className="mt-1.5 text-[13.5px] text-neutral-400">
                                Save a job posting, then practise the interview rounds that company would run.
                            </p>
                        </div>
                        <Button variant="primary" className="text-sm" onClick={() => setNewOpen(true)}>
                            New job
                        </Button>
                    </div>

                    <form onSubmit={handleSubmit(applySearch)} className="mt-5 flex flex-wrap items-center gap-2.5">
                        <input
                            {...register("q")}
                            className="input w-[280px] text-[13.5px]"
                            placeholder="Search by company or title…"
                        />
                        <Button type="submit" variant="primary" className="text-[13px]">
                            Search
                        </Button>
                        {q && (
                            <Button variant="ghost" className="text-[13px]" onClick={clearSearch}>
                                Clear
                            </Button>
                        )}
                    </form>
                </div>

                <div className="px-7 pb-[26px] pt-2">
                    {error ? (
                        <p className="px-3 py-6 text-[13.5px] text-gap">Couldn't load your jobs.</p>
                    ) : (
                        <>
                            <JobsTable
                                jobs={data?.items ?? []}
                                loading={isFetching}
                                emptyMessage={
                                    q
                                        ? "No jobs match that search."
                                        : "No jobs yet — add a job posting to practise its interview rounds."
                                }
                            />
                            {!isFetching && (
                                <Pagination page={data?.page ?? page} totalPages={data?.pages ?? 0} onPageChange={goToPage} />
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
