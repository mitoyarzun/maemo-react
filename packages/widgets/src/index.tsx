// Typed components with friendly names over the maemo-react elements.
import type { ReactNode } from 'react';
import type { CommonProps, ListColumn, ListRow, MaemoIntrinsicElements, WidgetTarget } from '@maemo-react/types';

type El<K extends keyof MaemoIntrinsicElements> = MaemoIntrinsicElements[K];

export type WindowProps = El<'hildon-window'>;

/**
 * A top-level window: a HildonWindow on the tablet. It takes one child and,
 * as a second child, a Menu. Do not pass visible: the renderer shows the
 * window when its content exists.
 */
export function Window(props: WindowProps) {
  return <hildon-window {...props} />;
}

export type BoxProps = Omit<El<'gtk-vbox'>, 'children'> & {
  /** Put the children in a column. Default: a row. */
  vertical?: boolean;
  children?: ReactNode;
};

/** A row or a column of children. A change of vertical makes a new widget. */
export function Box({ vertical = false, ...rest }: BoxProps) {
  return vertical ? <gtk-vbox {...rest} /> : <gtk-hbox {...rest} />;
}

export type LabelProps = El<'gtk-label'>;

/** Text. The children must be text. */
export function Label(props: LabelProps) {
  return <gtk-label {...props} />;
}

export type ButtonProps = Omit<El<'gtk-button'>, 'onClicked'> & {
  onClick?: () => void;
};

/** A push button. The children are its label. */
export function Button({ onClick, ...rest }: ButtonProps) {
  return <gtk-button {...rest} onClicked={onClick ? () => onClick() : undefined} />;
}

export type EntryProps = Omit<El<'gtk-entry'>, 'text' | 'onChanged'> & {
  /** The text. Give it to make a controlled entry. See "Controlled values" in the README. */
  value?: string;
  /** Called with the new text after each change. */
  onChangeText?: (text: string) => void;
};

/** A one-line text field. */
export function Entry({ value, onChangeText, ...rest }: EntryProps) {
  return (
    <gtk-entry
      {...rest}
      text={value}
      onChanged={onChangeText ? (target: WidgetTarget) => onChangeText(String(target.get('text') ?? '')) : undefined}
    />
  );
}

export type ScrolledWindowProps = El<'gtk-scrolled-window'>;

/** Scroll bars around one child. */
export function ScrolledWindow(props: ScrolledWindowProps) {
  return <gtk-scrolled-window {...props} />;
}

export type { ListColumn, ListRow } from '@maemo-react/types';

export type ListProps<Row extends ListRow> = Pick<CommonProps, 'key' | 'ref' | 'expand' | 'fill' | 'padding' | 'packType'> &
  Pick<El<'gtk-tree-view'>, 'visible' | 'sensitive' | 'name'> & {
  data: readonly Row[];
  /** Read when the list mounts. To change the fields or kinds, give the List a new key. */
  columns: readonly ListColumn[];
  /** The key of the selected row, or null. Give it to control the selection. */
  selected?: string | null;
  onSelect?: (key: string | null, row: Row | null) => void;
  /** The user tapped a toggle. The row keeps its old value until data changes. */
  onToggle?: (key: string, field: string, value: boolean, row: Row) => void;
  /** Default: true when a column has a title. */
  headersVisible?: boolean;
  widthRequest?: number;
  heightRequest?: number;
};

/**
 * A list of rows in a GtkTreeView, inside a ScrolledWindow. It takes no
 * children: the rows come from data, and only the changed rows go to GTK.
 */
export function List<Row extends ListRow>({ data, columns, onSelect, onToggle, headersVisible, expand, fill, padding, packType, visible, sensitive, ...rest }: ListProps<Row>) {
  const rowOf = (key: string | null) => (key === null ? null : (data.find((r) => r.key === key) ?? null));
  return (
    <ScrolledWindow expand={expand} fill={fill} padding={padding} packType={packType} visible={visible} sensitive={sensitive}>
      <gtk-tree-view
        {...rest}
        data={data}
        columns={columns}
        headersVisible={headersVisible ?? columns.some((c) => c.title !== undefined)}
        onSelect={onSelect ? (key) => onSelect(key, rowOf(key)) : undefined}
        onToggle={onToggle ? (key, field, value) => onToggle(key, field, value, rowOf(key)!) : undefined}
      />
    </ScrolledWindow>
  );
}

export type ToggleButtonProps = Omit<El<'gtk-toggle-button'>, 'onToggled'> & {
  /** Called with the new state after each change. */
  onToggle?: (active: boolean) => void;
};

/**
 * A button that stays pressed. The children are its label. Give active to
 * control it. See "Controlled values" in the README.
 */
export function ToggleButton({ onToggle, ...rest }: ToggleButtonProps) {
  return <gtk-toggle-button {...rest} onToggled={onToggle ? (target: WidgetTarget) => onToggle(target.get('active') === true) : undefined} />;
}

export type CheckButtonProps = Omit<El<'gtk-check-button'>, 'onToggled'> & {
  onToggle?: (active: boolean) => void;
};

/** A check box with a label. Give active to control it. See "Controlled values" in the README. */
export function CheckButton({ onToggle, ...rest }: CheckButtonProps) {
  return <gtk-check-button {...rest} onToggled={onToggle ? (target: WidgetTarget) => onToggle(target.get('active') === true) : undefined} />;
}

export type ScaleProps = Omit<El<'gtk-hscale'>, 'children'> & {
  /** A vertical slider. Default: horizontal. */
  vertical?: boolean;
};

/**
 * A slider. onChangeValue runs when the user releases it (or changes it with
 * a key), not during the drag. digits defaults to 0: whole numbers. Give
 * value to control it. See "Controlled values" in the README.
 */
export function Scale({ vertical = false, digits = 0, ...rest }: ScaleProps) {
  return vertical ? <gtk-vscale digits={digits} {...rest} /> : <gtk-hscale digits={digits} {...rest} />;
}

export type ComboBoxProps = Omit<El<'gtk-combo-box'>, 'onChanged' | 'children'> & {
  /** Called with the index and the item after the user picks a row. */
  onChangeActive?: (index: number, item: string | undefined) => void;
};

/**
 * A drop-down list of text items. active is the index of the chosen item, -1
 * for none. Give active to control it. See "Controlled values" in the README.
 */
export function ComboBox({ items, onChangeActive, ...rest }: ComboBoxProps) {
  return (
    <gtk-combo-box
      {...rest}
      items={items}
      onChanged={
        onChangeActive
          ? (target: WidgetTarget) => {
              const i = Number(target.get('active'));
              onChangeActive(i, items?.[i]);
            }
          : undefined
      }
    />
  );
}

export type MenuProps = { children?: ReactNode };

/** The menu of a Window. Put it inside the Window, next to the content. */
export function Menu(props: MenuProps) {
  return <gtk-menu {...props} />;
}

export type MenuItemProps = Omit<El<'gtk-menu-item'>, 'children' | 'onActivate'> & {
  children?: string | number | Array<string | number>;
  onActivate?: () => void;
};

/** An item of a Menu. The children are its text. */
export function MenuItem({ children, onActivate, ...rest }: MenuItemProps) {
  return (
    <gtk-menu-item {...rest} onActivate={onActivate ? () => onActivate() : undefined}>
      <gtk-label xalign={0}>{children}</gtk-label>
    </gtk-menu-item>
  );
}

/** A line between menu items. */
export function MenuSeparator() {
  return <gtk-separator-menu-item />;
}
