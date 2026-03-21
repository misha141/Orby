export default function OrbyAvatar({ isListening }) {
  return (
    <section className="avatarPanel">
      <div className={`orbyCore ${isListening ? 'active' : ''}`}>
        <div className="orbyRing ring1" />
        <div className="orbyRing ring2" />
        <div className="orbyRing ring3" />
        <div className="orbyCenter" />
      </div>

      <div className="avatarText">
        <h2>Orby</h2>
        <p>{isListening ? 'I am listening...' : 'Ready when you are.'}</p>
      </div>
    </section>
  );
}
