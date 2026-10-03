import type { ComponentChildren, ComponentType, JSX } from "preact"
import { IconArrowLeft, IconEllipsisVertical, type IconProps } from "@spy4x/preact-icons"
import { Button, type ButtonVariant } from "@spy4x/preact-ui/button"
import { Dropdown } from "@spy4x/preact-ui/dropdown"
import type { Navigate } from "./progressive.tsx"

/** Touch targets in the header are 44 px on a phone and the library's own size from `sm` up. */
const TOUCH = "min-h-11 min-w-11 justify-center sm:min-h-9 sm:min-w-9"

export interface PageHeaderProps {
  /** The page's `h1`. It stays on one line and truncates; the full text is its tooltip. */
  title: string
  /** One quiet line under the title, such as the group a list belongs to. */
  subtitle?: ComponentChildren
  /** A link back to the parent page, drawn as an arrow before the title. `label` is its name. */
  back?: { href: string; label: string }
  /** Follows `back` without a page load. */
  navigate?: Navigate
  /** The page's one primary action, usually a {@link PageAction}. */
  action?: ComponentChildren
  /**
   * The page's supplementary actions, as `DropdownItem`s. Given, they sit behind one "More
   * actions" button (three dots) after the primary action.
   */
  menu?: ComponentChildren
  /** The overflow button's accessible name. Defaults to "More actions". */
  menuLabel?: string
  /** `data-e2e` of the overflow button. */
  menuDataE2E?: string
  /** `data-e2e` of the `h1`. */
  titleDataE2E?: string
}

/**
 * The header every signed-in page starts with: an optional back arrow, the title (and a subtitle)
 * on the left, the primary action and an optional "More actions" menu on the right. On a phone the
 * title keeps to one line and the actions stay beside it, so a long title never pushes them under
 * it.
 */
export function PageHeader(
  { title, subtitle, back, navigate, action, menu, menuLabel, menuDataE2E, titleDataE2E }:
    PageHeaderProps,
): JSX.Element {
  return (
    <header class="flex min-w-0 items-center gap-3" data-e2e="page-header">
      {back && (
        <Button
          href={back.href}
          navigate={navigate}
          variant="icon"
          size="md"
          aria-label={back.label}
          class={`-ml-2 ${TOUCH}`}
          data-e2e="page-back"
        >
          <IconArrowLeft class="size-5" aria-hidden="true" />
        </Button>
      )}
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <h1
          class="truncate text-xl font-semibold sm:text-2xl"
          title={title}
          data-e2e={titleDataE2E}
        >
          {title}
        </h1>
        {subtitle && <p class="truncate text-sm text-muted">{subtitle}</p>}
      </div>
      {(action || menu) && (
        <div class="flex shrink-0 items-center gap-2">
          {action}
          {menu && (
            <Dropdown
              triggerLabel={menuLabel ?? "More actions"}
              menuLabel={menuLabel ?? "More actions"}
              triggerDataE2E={menuDataE2E}
              triggerClasses={`inline-flex items-center rounded-md text-muted hover:bg-hover hover:text-foreground ${TOUCH}`}
              trigger={<IconEllipsisVertical class="size-5" aria-hidden="true" />}
            >
              {menu}
            </Dropdown>
          )}
        </div>
      )}
    </header>
  )
}

/** What {@link PageAction} takes; either `href` (a link) or `onClick` (a button). */
export interface PageActionProps {
  /** Visible from `sm` up, and always the accessible name. */
  label: string
  /** Shown on every screen; on a phone it is all a person sees of the action. */
  Icon: ComponentType<IconProps>
  href?: string
  navigate?: Navigate
  onClick?: () => void
  variant?: ButtonVariant
  disabled?: boolean
  dataE2E?: string
}

/**
 * A page header's primary action: icon and label from `sm` up, the icon alone on a phone. The label
 * stays in the markup for screen readers, so the button keeps its name at every width.
 */
export function PageAction(
  { label, Icon, href, navigate, onClick, variant = "primary", disabled, dataE2E }: PageActionProps,
): JSX.Element {
  const content = (
    <>
      <Icon class="size-5" aria-hidden="true" />
      <span class="sr-only sm:not-sr-only">{label}</span>
    </>
  )
  return href !== undefined
    ? (
      <Button
        href={href}
        navigate={navigate}
        variant={variant}
        disabled={disabled}
        class={TOUCH}
        data-e2e={dataE2E}
      >
        {content}
      </Button>
    )
    : (
      <Button
        type="button"
        variant={variant}
        onClick={onClick}
        disabled={disabled}
        class={TOUCH}
        data-e2e={dataE2E}
      >
        {content}
      </Button>
    )
}
