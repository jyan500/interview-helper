import { LOADING_BAR } from "../constants"

export const SkeletonText = () => {
	return (
		<div className={"mt-2 animate-pulse" + LOADING_BAR}></div>
	)
}