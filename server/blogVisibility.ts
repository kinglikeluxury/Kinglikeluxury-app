/**
 * Public readers may only resolve published blog posts. Administrators can
 * inspect drafts in the existing authenticated management workflow.
 */
export function canReadBlogPost(published: boolean, isAdmin: boolean): boolean {
  return published || isAdmin;
}
