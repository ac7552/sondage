# Matching Fellows with historians. A Fellow chooses up to three historians they'd
# like; a historian chooses the Fellows they'd like to work with. When both say
# yes, an admin confirms the match (usually after a phone call with the Fellow).
class MatchesController < ApplicationController
  def show
    case current_user.role
    when "fellow" then fellow_page
    when "historian" then historian_page
    else admin_page
    end
  end

  # The Fellow's short introduction, shown to historians.
  def update_intro
    fellow = current_user.fellow or return head(:forbidden)
    fellow.update!(params.require(:fellow).permit(:match_intro, :languages, :seeking_historian))
    redirect_to match_path, notice: "Saved."
  end

  # The historian's profile, shown to Fellows. Its own page.
  def edit_profile
    return head(:forbidden) unless current_user.historian?
    @profile = current_user.historian_profile || current_user.build_historian_profile(accepting: true)
    render :profile
  end

  def update_profile
    return head(:forbidden) unless current_user.historian?
    profile = current_user.historian_profile || current_user.build_historian_profile
    profile.update!(params.require(:historian_profile).permit(:headline, :bio, :languages, :regions, :specialties, :accepting))
    redirect_to edit_historian_profile_path, notice: "Your profile is saved. This is what Fellows will read."
  end

  # Fellows pick historians; historians pick Fellows. Pressing again takes it back.
  def choose
    interest =
      if current_user.fellow?
        fellow = current_user.fellow or return head(:forbidden)
        historian = User.where(role: "historian").joins(:historian_profile).merge(HistorianProfile.accepting).find(params[:historian_id])
        return redirect_to(match_path, alert: "You already have a historian.") if fellow.historian
        fellow.update!(seeking_historian: true) if params[:want] != "0" && !fellow.seeking_historian
        MatchInterest.find_or_initialize_by(fellow:, historian:).tap { |m| m.fellow_wants = params[:want] != "0" }
      elsif current_user.historian?
        fellow = Fellow.where(seeking_historian: true, historian_id: nil).find(params[:fellow_id])
        MatchInterest.find_or_initialize_by(fellow:, historian: current_user).tap { |m| m.historian_wants = params[:want] != "0" }
      else
        return head(:forbidden)
      end
    return redirect_to(match_path, alert: "This choice has already been decided.") unless interest.status == "open"
    became_mutual = interest.mutual? && !(interest.fellow_wants_was && interest.historian_wants_was)
    if interest.save
      AuditEvent.record!("match.#{current_user.role}_#{params[:want] == '0' ? 'withdrew' : 'chose'}", actor: current_user, fellow: interest.fellow, subject: interest)
      if became_mutual
        User.where(role: "admin").find_each { |a| MatchMailer.mutual(a, interest).deliver_later }
      end
      redirect_to match_path, notice: became_mutual ? "You both chose each other. Sondage will be in touch to confirm." : "Saved."
    else
      redirect_to match_path, alert: interest.errors.full_messages.to_sentence
    end
  end

  def confirm
    return head(:forbidden) unless current_user.admin?
    interest = MatchInterest.undecided.find(params[:id])
    interest.confirm!(current_user)
    AuditEvent.record!("match.confirmed", actor: current_user, fellow: interest.fellow, subject: interest, historian: interest.historian.name)
    MatchMailer.confirmed(interest.fellow.user, interest).deliver_later
    MatchMailer.confirmed(interest.historian, interest).deliver_later
    redirect_to match_path, notice: "#{interest.fellow.display_name} is now matched with #{interest.historian.name}."
  end

  def decline
    return head(:forbidden) unless current_user.admin?
    interest = MatchInterest.undecided.find(params[:id])
    interest.decline!(current_user)
    AuditEvent.record!("match.declined", actor: current_user, fellow: interest.fellow, subject: interest)
    redirect_to match_path, notice: "Declined."
  end

  private

  def fellow_page
    @fellow = current_user.fellow or return head(:not_found)
    @profiles = HistorianProfile.accepting.includes(:user).order(:id)
    @choices = @fellow.match_interests.undecided.where(fellow_wants: true).pluck(:historian_id)
    @wanted_by = @fellow.match_interests.undecided.where(historian_wants: true).pluck(:historian_id)
    render :fellow
  end

  def historian_page
    @profile = current_user.historian_profile || current_user.build_historian_profile(accepting: true)
    @fellows = Fellow.where(seeking_historian: true, historian_id: nil).includes(:user).order(:created_at)
    interests = current_user.match_interests.undecided.where(fellow_id: @fellows.map(&:id)).index_by(&:fellow_id)
    @mine = interests.select { |_, m| m.historian_wants }.keys
    @wants_me = interests.select { |_, m| m.fellow_wants }.keys
    @matched = current_user.matched_fellows.includes(:user)
    render :historian
  end

  def admin_page
    return head(:forbidden) unless current_user.admin?
    @mutual = MatchInterest.mutual.includes(:historian, fellow: :user).order(:updated_at)
    @one_sided = MatchInterest.undecided.interested.where.not(id: @mutual.map(&:id)).includes(:historian, fellow: :user).order(updated_at: :desc)
    @seeking = Fellow.where(seeking_historian: true, historian_id: nil).includes(:user)
    @matched = Fellow.where.not(historian_id: nil).includes(:user, :historian)
    render :admin
  end
end
