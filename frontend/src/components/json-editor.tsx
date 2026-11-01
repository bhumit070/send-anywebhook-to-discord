import { json } from '@codemirror/lang-json';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { cn } from 'cn';

const editorTheme = EditorView.theme({
  '&': { fontSize: '12.5px', backgroundColor: 'transparent' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
  '&.cm-focused': { outline: 'none' },
});

export interface JsonEditorProps {
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  minHeight?: string;
  maxHeight?: string;
  className?: string;
}

export default function JsonEditor({
  value,
  onChange,
  readOnly,
  minHeight = '160px',
  maxHeight = '480px',
  className,
}: JsonEditorProps) {
  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  return (
    <div className={cn('overflow-hidden rounded-md border bg-muted/30', className)}>
      <CodeMirror
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        editable={!readOnly}
        extensions={[json(), editorTheme, EditorView.lineWrapping]}
        theme={dark ? 'dark' : 'light'}
        minHeight={minHeight}
        maxHeight={maxHeight}
        basicSetup={{ foldGutter: true, highlightActiveLine: !readOnly, lineNumbers: !readOnly }}
      />
    </div>
  );
}

