/**
 * The Profile page — reached from the nav's account menu. Who the candidate is, as far as interviews are
 * concerned: the picture, the default role/level the kickoff pre-fills, and their background (roles,
 * projects, skills), which behavioral interviews draw on. The background can be pre-filled from an
 * uploaded resume (ResumeImportCard), reviewed before anything is saved.
 *
 * A thin SHELL like SettingsPage: it lays out the app chrome and stacks self-contained cards, each owning
 * its own data, forms and saves. (Account details and the password stay on Settings: those are Supabase
 * Auth attributes, not interview data.) The app nav and the sidebar come from SettingsLayout.
 */
import AvatarCard from "../components/profile/AvatarCard";
import DefaultsCard from "../components/profile/DefaultsCard";
import ExperienceCard from "../components/profile/ExperienceCard";
import ProjectsCard from "../components/profile/ProjectsCard";
import ResumeImportCard from "../components/profile/ResumeImportCard";
import SkillsCard from "../components/profile/SkillsCard";

export default function ProfilePage() {
    return (
        <>
            <h1 className="mt-1.5 font-heading text-[34px] font-medium leading-[1.05]">Profile</h1>

            <div className="mt-6 flex flex-col gap-6">
                <AvatarCard />
                <DefaultsCard />
                <ResumeImportCard />
                <ExperienceCard />
                <ProjectsCard />
                <SkillsCard />
            </div>
        </>
    );
}
