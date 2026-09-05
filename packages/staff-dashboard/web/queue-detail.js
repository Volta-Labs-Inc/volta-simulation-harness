export function assignmentQueueDetail(bundle, response, evaluation) {
  const item = bundle.assignment;
  const responseIsCurrent = response?.attemptNumber === item.attemptNumber;
  const evaluationIsCurrent = evaluation?.attemptNumber === item.attemptNumber;
  return bundle.blocked
    ? item.repositoryReadback === "pending"
      ? "Repository readback pending"
      : bundle.blocked.title
    : bundle.reviewRequest && bundle.reviewRequest.reviewRequestId !== response?.reviewRequestId
      ? "Review requested · response pending"
    : evaluationIsCurrent
      ? "Review responded · evaluation recorded"
      : responseIsCurrent
        ? bundle.acceptedSubmission
          ? "Review responded · evaluation open"
          : "Review responded · submission pending"
        : bundle.reviewRequest
          ? "Review requested · response pending"
          : item.lifecycleState === "submitted"
            ? "Submission accepted · evaluation open"
            : item.lifecycleState === "reopened"
              ? `Attempt ${item.attemptNumber} active · prior attempt preserved`
              : "Attempt active · no review pending";
}
