export default function OrbyAvatar({ isListening, isSpeaking, isLoading }) {
  const active = isListening || isSpeaking || isLoading;

  const stateClass = isSpeaking
    ? 'speaking'
    : isListening
    ? 'active'
    : isLoading
    ? 'processing'
    : '';

  const label = isSpeaking
    ? 'Speaking...'
    : isListening
    ? 'Listening...'
    : isLoading
    ? 'Thinking...'
    : 'Tap to speak';

  return (
    <section className="avatarPanel">
      <div className={`orbyCore ${stateClass}`}>
        <div className="orbyRing ring1" />
        <div className="orbyRing ring2" />
        <div className="orbyRing ring3" />
        <div className="orbyCenter" />
      </div>

      <div className="avatarText">
        <h2>Orby</h2>
        <p>{label}</p>
      </div>
    </section>
  );
}
