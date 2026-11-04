class ApplicationController < ActionController::Base
  before_action :authenticate_user!
  # Older browsers can still reset a password and approve a safety request.
  allow_browser versions: :modern, if: -> { !devise_controller? && controller_name != "safety" }
  layout -> { devise_controller? ? "plain" : "application" }

  helper_method :can_edit_fellow?

  private

  def require_role(*roles)
    head :forbidden unless current_user&.role.in?(roles.map(&:to_s))
  end

  def require_admin = require_role(:admin)

  # Loads the Fellow from :fellow_id (or :id) and checks the person may see them.
  def set_fellow
    @fellow = Fellow.find(params[:fellow_id] || params[:id])
    head :not_found unless current_user.can_see?(@fellow)
  end

  # Admins and the Fellow themselves shape the profile; historians read it.
  def can_edit_fellow?(fellow = @fellow)
    current_user.admin? || fellow.user_id == current_user.id
  end

  def require_fellow_editor
    head :forbidden unless can_edit_fellow?
  end

  def stage_for_new_material
    case @fellow.stage
    when "intake" then "intake"
    when "ten_by_ten" then "ten_by_ten"
    when "delivered" then "after_interview"
    else "refining"
    end
  end

  def audit(action, subject: nil, **data)
    AuditEvent.record!(action, actor: current_user, fellow: @fellow, subject:, **data)
  end
end
