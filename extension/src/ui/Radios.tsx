/** Сегментный переключатель на настоящих радио-кнопках (стрелки, фокус, скринридеры — из коробки). */
export function Radios<T extends string>(props: { name: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; class?: string; labelledBy?: string }) {
  return (
    <div class={`seg ${props.class ?? ''}`} role="radiogroup" aria-labelledby={props.labelledBy}>
      {props.options.map(([v, label]) => (
        <label>
          <input type="radio" name={props.name} value={v} checked={props.value === v} onChange={() => props.onChange(v)} />
          {label}
        </label>
      ))}
    </div>
  );
}
