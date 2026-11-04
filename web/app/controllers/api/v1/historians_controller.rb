# Choosing a historian, from the desktop app. Same rules as the web page.
class Api::V1::HistoriansController < Api::V1::BaseController
  before_action :require_fellow!

  def index
    interests = @fellow.match_interests.undecided.index_by(&:historian_id)
    render json: {
      matched: @fellow.historian && (@fellow.historian.historian_profile&.as_api_json || { id: @fellow.historian_id, name: @fellow.historian.name }),
      seeking: @fellow.seeking_historian,
      intro: @fellow.match_intro, languages: @fellow.languages,
      max_choices: MatchInterest::MAX_FELLOW_CHOICES,
      historians: HistorianProfile.accepting.includes(:user).order(:id).map { |p|
        m = interests[p.user_id]
        p.as_api_json.merge(chosen: !!m&.fellow_wants, wants_you: !!m&.historian_wants)
      }
    }
  end

  def choose = set_choice(true)
  def unchoose = set_choice(false)

  def update_intro
    @fellow.update!(params.require(:fellow).permit(:match_intro, :languages, :seeking_historian))
    head :no_content
  end

  private

  def set_choice(want)
    return render(json: { error: "You already have a historian." }, status: :unprocessable_entity) if @fellow.historian
    historian = User.where(role: "historian").joins(:historian_profile).merge(HistorianProfile.accepting).find(params[:id])
    interest = MatchInterest.find_or_initialize_by(fellow: @fellow, historian:)
    return render(json: { error: "This has already been decided." }, status: :unprocessable_entity) unless interest.status == "open"
    was_mutual = interest.fellow_wants && interest.historian_wants
    interest.fellow_wants = want
    # Choosing a historian also lets historians see the Fellow's card.
    @fellow.update!(seeking_historian: true) if want && !@fellow.seeking_historian
    interest.save!
    AuditEvent.record!("match.fellow_#{want ? 'chose' : 'withdrew'}", actor: current_user, fellow: @fellow, subject: interest)
    if interest.mutual? && !was_mutual
      User.where(role: "admin").find_each { |a| MatchMailer.mutual(a, interest).deliver_later }
    end
    render json: { chosen: interest.fellow_wants, mutual: interest.mutual? }
  end
end
